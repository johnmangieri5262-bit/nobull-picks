const express = require('express');
const router = express.Router();
const https = require('https');

var FINNHUB_KEY = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';

var OFFICIAL_PICKS = [
  { symbol: 'V', name: 'Visa Inc.', type: 'stock', locked: '2026-06-23T19:15:00' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', locked: '2026-07-01T13:54:00' },
  { symbol: 'CEG', name: 'Constellation Energy', type: 'stock', locked: '2026-07-07T13:55:00' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock', locked: '2026-07-21T13:00:00' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway', type: 'stock', locked: '2026-07-21T13:00:00' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor', type: 'stock', locked: '2026-08-04T19:15:00' },
  { symbol: 'TT', name: 'Trane Technologies', type: 'stock', locked: '2026-08-04T19:15:00' },
  { symbol: 'COIN', name: 'Coinbase Global', type: 'stock', locked: '2026-08-12T19:15:00' },
  { symbol: 'PLNT', name: 'Planet Fitness', type: 'stock', locked: '2026-08-19T19:15:00' },
  { symbol: 'CEG', name: 'Constellation Energy', type: 'stock', locked: '2026-08-25T19:15:00' },
  { symbol: 'WMT', name: 'Walmart Inc.', type: 'stock', locked: '2026-09-02T19:15:00' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', locked: '2026-09-09T19:15:00' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', type: 'stock', locked: '2026-09-16T13:30:00' },
  { symbol: 'MU', name: 'Micron Technology', type: 'stock', locked: '2026-09-23T19:15:00' },
  { symbol: 'MSI', name: 'Motorola Solutions, Inc.', type: 'stock', locked: '2026-10-07T19:15:00' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', type: 'stock', locked: '2026-10-14T09:42:00' },
  { symbol: 'CDNS', name: 'Cadence Design Systems, Inc.', type: 'stock', locked: '2026-10-28T11:59:00' },
  { symbol: 'CTAS', name: 'Cintas Corporation', type: 'stock', locked: '2026-11-03T19:15:00' }
]; 

var ENTRY_PRICES_LIST = [
  328.50, 237.53, 239.00, 206.40, 489.83, 419.27, 472.24, 
  149.72, 52.73, 277.35, 105.97, 252.15, 519.00, 1076.76, 
  448.28, 765.22, 342.65, 225.00
];
var pricesLocked = true;
