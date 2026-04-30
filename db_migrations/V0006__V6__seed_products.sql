INSERT INTO products (category_id, name, description, price, old_price, specs, in_stock, is_featured, sort_order, created_at) VALUES
  (1, 'NVIDIA RTX 4080 Super 16GB', 'Топовая карта для 4K gaming и стриминга', 89990, 99990, '{"vram":"16GB","tdp":"320W","outputs":"3x DP 1.4a, 1x HDMI 2.1"}', true, true, 1, NOW()),
  (1, 'AMD RX 7800 XT 16GB', 'Отличное соотношение цена/качество', 44990, 49990, '{"vram":"16GB","tdp":"263W","outputs":"3x DP 2.1, 1x HDMI 2.1"}', true, true, 2, NOW()),
  (2, 'Intel Core i9-14900K', '24 ядра, до 6.0 GHz boost', 49990, 54990, '{"cores":"24","threads":"32","tdp":"125W","socket":"LGA1700"}', true, true, 1, NOW()),
  (2, 'AMD Ryzen 9 7900X', '12 ядер, 5nm архитектура', 39990, 44990, '{"cores":"12","threads":"24","tdp":"170W","socket":"AM5"}', true, true, 2, NOW()),
  (3, 'Kingston Fury Beast 32GB DDR5', '2x16GB, 6000MHz, XMP 3.0', 12990, 14990, '{"capacity":"32GB","speed":"6000MHz","type":"DDR5","latency":"CL36"}', true, false, 1, NOW()),
  (5, 'Samsung 990 Pro 2TB NVMe', 'PCIe 4.0, 7450/6900 MB/s', 19990, 22990, '{"capacity":"2TB","interface":"PCIe 4.0 x4","read":"7450 MB/s","write":"6900 MB/s"}', true, false, 1, NOW()),
  (8, 'UltraGame Pro', 'RTX 4080 + i9-14900K + 32GB DDR5 + 2TB NVMe', 189990, 219990, '{"gpu":"RTX 4080 Super","cpu":"i9-14900K","ram":"32GB DDR5","storage":"2TB NVMe","psu":"850W Gold"}', true, true, 1, NOW()),
  (8, 'WorkStation X', 'Xeon W5-3435X + 128GB ECC + A4000', 289990, 319990, '{"gpu":"NVIDIA A4000","cpu":"Xeon W5-3435X","ram":"128GB ECC","storage":"4TB NVMe RAID","psu":"1000W Platinum"}', true, true, 2, NOW()),
  (8, 'StreamBeast', 'Ryzen 9 7900X + RTX 4070 + 32GB DDR5', 139990, 159990, '{"gpu":"RTX 4070 Ti","cpu":"Ryzen 9 7900X","ram":"32GB DDR5","storage":"1TB NVMe","psu":"750W Gold"}', true, true, 3, NOW())