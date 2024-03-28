const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { URL } = require('url');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Enable trust proxy
app.set('trust proxy', 1);

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // limit each IP to 50 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Proxy requests
app.all('/get', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    const response = await axios({ method: req.method, url, responseType: 'stream', data: req.body });

    // Forward headers, except for CORS headers
    const filteredHeaders = Object.entries(response.headers)
      .filter(([key]) => !['access-control-allow-origin', 'access-control-allow-headers'].includes(key.toLowerCase()));
    filteredHeaders.forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    const contentType = response.headers['content-type'];

    // Check if response is HTML
    if (contentType && contentType.includes('text/html')) {
      const html = await streamToString(response.data);
      const dom = new JSDOM(html, { url });

      // Convert relative URLs to absolute URLs
      const document = dom.window.document;
      const elements = document.querySelectorAll('a[href], link[href], img[src], script[src]');
      elements.forEach(element => {
        const src = element.getAttribute('src');
        const href = element.getAttribute('href');
        if (src) {
          element.setAttribute('src', new URL(src, url).href);
        }
        if (href) {
          element.setAttribute('href', new URL(href, url).href);
        }
      });

      // Send modified HTML
      res.send(dom.serialize());
    } else {
      // If not HTML, send response as is
      response.data.pipe(res);
    }
  } catch (error) {
    res.status(error.response.status || 500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`CORS Proxy server listening on port ${PORT}`);
});

// Helper function to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
