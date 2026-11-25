const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.disable('x-powered-by');

app.use(
  express.static(__dirname, {
    index: 'index.html',
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Fiszki static server listening on http://${HOST}:${PORT}`);
});
