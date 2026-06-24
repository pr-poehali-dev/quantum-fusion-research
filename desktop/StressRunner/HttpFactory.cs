using System.Net;
using System.Net.Http;
using System.Net.Sockets;

namespace StressRunner;

/// <summary>
/// Фабрика HttpClient с устойчивым подключением:
/// 1) системный прокси (корп-сети);
/// 2) ConnectCallback — если системный DNS не резолвит хост (блокировка),
///    берём IP через DNS-over-HTTPS (DohResolver) и коннектимся напрямую по IP.
/// </summary>
public static class HttpFactory
{
    public static HttpClient Create(TimeSpan timeout)
    {
        var handler = new SocketsHttpHandler
        {
            UseProxy = true,
            Proxy = WebRequest.GetSystemWebProxy(),
            ConnectCallback = ConnectAsync,
        };
        return new HttpClient(handler) { Timeout = timeout };
    }

    private static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext ctx, CancellationToken ct)
    {
        string host = ctx.DnsEndPoint.Host;
        int port = ctx.DnsEndPoint.Port;

        IPAddress[]? ips = null;

        // 1) Пытаемся системным DNS.
        try { ips = await Dns.GetHostAddressesAsync(host, ct); }
        catch { ips = null; }

        // 2) Если не вышло — DNS-over-HTTPS (обход блокировки).
        if (ips == null || ips.Length == 0)
            ips = await DohResolver.ResolveAsync(host);

        if (ips == null || ips.Length == 0)
            throw new HttpRequestException($"Не удалось определить IP для {host} (DNS + DoH не дали результата).");

        // Коннектимся к первому рабочему IP.
        Exception? last = null;
        foreach (var ip in ips)
        {
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(ip, port), ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (Exception ex)
            {
                last = ex;
                socket.Dispose();
            }
        }
        throw last ?? new HttpRequestException($"Не удалось подключиться к {host}.");
    }
}
