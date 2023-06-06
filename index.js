import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import * as dotenv from 'dotenv';
import authenticate from './authenticate.js';
import authenticateSocket from './authenticateSocket.js';
import prisma from './prisma/client.js';
import updateSocketId from './updateSocketId.js';
import { v4 as uuidv4 } from 'uuid';

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

io.use(authenticateSocket);

io.on('connection', (socket) => {
    const userName = `${socket.data.user.firstName} ${socket.data.user.lastName}`
    console.log(`${userName} has connected.`);

    updateSocketId(socket);

    socket.on('disconnect', () => {
        updateSocketId(socket, true);
        console.log(`${userName} has disconnected.`);
    })

    socket.on('private message', async ({ to, message }) => {

        const receiver = await prisma.user.findUnique({
            where: { userPath: to }
        })

        if (!receiver) {

            socket.emit('error', 'Could not find receiver');
            return;

        }
        const uuid = uuidv4();
        const dbMessage = await prisma.privateMessage.create({
            data: {
                to_id: receiver.id,
                message,
                from_id: socket.data.user.id,
                id: uuid
            },
            select: {
                message: true,
                created: true,
                id: true,
                seen: true,
                from: {
                    select: { userPath: true },
                }
            }
        });

        if (!dbMessage) {
            console.log('no db message');
            socket.emit('error', 'Could not send message');
            return;

        } else {

            if (receiver.socketId) {

                socket.to(receiver.socketId).emit('private message', { message: dbMessage });

            }

        }
    });
    socket.on('get conversation', async ({ userPath }) => {

        const conversationPartner = await prisma.user.findUnique({
            where: { userPath }
        })
        const messages = await prisma.privateMessage.findMany({
            where: {

                OR: [
                    {
                        from_id: socket.data.user.id,
                        to_id: conversationPartner.id,
                    },
                    {
                        to_id: socket.data.user.id,
                        from_id: conversationPartner.id,
                    }
                ],
            },
            select: {
                message: true,
                created: true,
                id: true,
                seen: true,
                from: {
                    select: { userPath: true },
                }
            },
            orderBy: {
                created: 'asc',
            }
        });

        const conversation = {
            userPath,
            messages,
            img: conversationPartner.image,
            displayName: `${conversationPartner.firstName} ${conversationPartner.lastName}`
        }

        socket.emit('get conversation', conversation);

    })

    socket.on('get conversation list', async () => {

        const sentList = await prisma.privateMessage.findMany({
            where: { from_id: socket.data.user.id, },
            distinct: ['to_id'],
            orderBy: {
                created: 'desc',
            },
            include: {
                to: {
                    select: {
                        firstName: true,
                        lastName: true,
                        userPath: true,
                        image: true,
                    }
                },
            }
        });
        const receivedList = await prisma.privateMessage.findMany({
            where: { to_id: socket.data.user.id, },
            distinct: ['from_id'],
            orderBy: {
                created: 'desc',
            },
            include: {
                from: {
                    select: {
                        firstName: true,
                        lastName: true,
                        userPath: true,
                        image: true,
                    }
                },
            }
        });
        const combinedList = [...sentList];

        combinedList.forEach(message => {
            message.message = `Du: ${message.message}`;
        });

        receivedList.forEach(message => {
            message.to = message.from
            let exists = false;

            for (let i = 0; i < combinedList.length; i++) {

                if (combinedList[i].to_id === message.from_id) {

                    exists = true;

                    if (combinedList[i].created < message.created) {

                        combinedList[i] = message;

                    }

                }

            }

            if (!exists) {

                combinedList.push(message);

            }
        });

        combinedList.sort((a, b) => {

            if (a.created < b.created) {

                return -1;

            }

            if (a.created > b.created) {

                return 1;

            }

            return 0;

        })

        combinedList.forEach(message => {
            delete message.from_id;
            delete message.to_id;
            delete message.id;
            delete message.from;
        });

        socket.emit('get conversation list', { conversations: combinedList })

    })

})

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/', (req, res) => {

    res.json({ message: 'Hello express!' });

})


server.listen(PORT, () => {
    console.log(`listening on port ${PORT}`);
});