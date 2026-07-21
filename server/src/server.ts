import app from './app.js';
import type { Request, Response } from 'express';
import { deleteLogsFile } from './services/s3.service.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.get('/', async (req: Request, res: Response) => {
    await deleteLogsFile('logs/logs.txt');
    res.send('Hello, World!');
})

app.get('/health', (req: Request, res: Response) => {
    res.status(200).send('Health check OK');
});