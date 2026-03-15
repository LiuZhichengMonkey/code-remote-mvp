import express from 'express';
import path from 'path';

const app = express();
const PORT = 3000;

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
