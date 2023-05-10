import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import * as dotenv from 'dotenv';
import authenticate from './authenticate.js';

dotenv.config();
const PORT = process.env.PORT || 8008;
const app = express();
app.use(cors({
    origin: 'http://localhost:3000',
}));
app.use(authenticate);

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/', (req, res) => {

    res.json({ message: 'Hello express!' });

})


server.listen(PORT, () => {
    console.log(`listening on port ${PORT}`);
});