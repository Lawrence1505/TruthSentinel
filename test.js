import express from 'express';
const app = express();
const port = 8080;

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`✅ Hello World server is running on http://localhost:${port}`);
});