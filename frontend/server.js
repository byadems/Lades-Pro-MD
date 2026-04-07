const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3000;
const DASHBOARD_URL = 'http://localhost:3001';

// Proxy everything to the original dashboard
app.use('/', createProxyMiddleware({
  target: DASHBOARD_URL,
  changeOrigin: true,
  ws: true,
  onError: (err, req, res) => {
    console.error('Proxy error:', err.message);
    res.status(502).send('Dashboard başlatılıyor...');
  }
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`📡 Forwarding to dashboard on ${DASHBOARD_URL}`);
});
