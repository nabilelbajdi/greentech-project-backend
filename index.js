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

        try {

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

        } catch (e) {

            console.log(e);

        }


    });

    socket.on('get conversation', async ({ userPath }) => {

        try {

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

        } catch (e) {

            console.log(e);

        }

    })

    socket.on('get conversation list', async () => {

        try {

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
                            profilePicture: true,
                        }
                    },
                }
            });
            const receivedList = await prisma.privateMessage.findMany({
                where: { to_id: socket.data.user.id, },
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
                            profilePicture: true,
                        }
                    },
                }
            });
            const combinedList = [...sentList];

            combinedList.forEach(message => {
                message.message = `Du: ${message.message}`;
                message.unseen = 0;
            });

            const receivedFrom = [];

            receivedList.forEach(message => {



                if (receivedFrom.filter(user => user.userPath === message.from.userPath).length === 0) {

                    receivedFrom.push({ userPath: message.from.userPath, unseen: 0 })

                }
                if (!message.seen) {
                    for (let i = 0; i < receivedFrom.length; i++) {

                        if (message.from.userPath === receivedFrom[i].userPath) {

                            receivedFrom[i].unseen++;

                        }
                    }
                }

                for (let i = 0; i < receivedFrom.length; i++) {

                    if (message.from.userPath === receivedFrom[i].userPath) {

                        if (receivedFrom[i].message) {

                            if (message.created > receivedFrom[i].message.created) {

                                receivedFrom[i].message = message;

                            }
                        } else {

                            receivedFrom[i].message = message;

                        }
                    }
                }
            })

            receivedFrom.forEach(user => {

                user.message.unseen = user.unseen;
                user.message.to = user.message.from
                let exists = false;

                for (let i = 0; i < combinedList.length; i++) {

                    if (combinedList[i].to_id === user.message.from_id) {

                        exists = true;

                        if (combinedList[i].created < user.message.created) {

                            combinedList[i] = user.message;

                        }

                    }

                }

                if (!exists) {

                    combinedList.push(user.message);

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

                if (message.to.profilePicture) {

                    message.to.image = message.to.profilePicture

                }
                delete message.to.profilePicture;
                delete message.from_id;
                delete message.to_id;
                delete message.id;
                delete message.from;
            });

            socket.emit('get conversation list', { conversations: combinedList })

        } catch (e) {

            console.log(e);

        }

    })

    socket.on('messages seen', async ({ seenMsgs }) => {

        try {

            for (let i = 0; i < seenMsgs.messages.length; i++) {

                await prisma.privateMessage.update({
                    where: { id: seenMsgs.messages[i] },
                    data: { seen: seenMsgs.time }
                })
            }

        } catch (e) {

            console.log(e);

        }


    })

    socket.on('notification', async (notification) => {

        try {

            const receiver = await prisma.user.findUnique({
                where: { userPath: notification.to },
                include: {
                    notificationsReceived: true,
                    notificationsSent: true,
                }
            })

            if (!receiver) {

                socket.emit('error', 'Could not find receiver');
                return;

            }

            let unseen = 0;

            for (let i = 0; i < receiver.notificationsReceived.length; i++) {

                if (!receiver.notificationsReceived[i].seen) {

                    unseen++;

                }

            }

            if (receiver.socketId) {

                socket.to(receiver.socketId).emit('notification', unseen);

            }

        } catch (e) {

            console.log(e);

        }



    });

    socket.on('notifications seen', async (seen) => {

        try {

            for (let i = 0; i < seen.notifications.length; i++) {

                await prisma.notification.update({
                    where: { id: seen.notifications[i] },
                    data: { seen: seen.time }
                })
            }

        } catch (e) {

            console.log(e);

        }

    })

    socket.on('get notifications', async () => {

        try {

            const data = await prisma.notification.findMany({
                where: { to_id: socket.data.user.id },
                orderBy: {
                    updated: 'asc'
                },
                include: {
                    from: {
                        select: {
                            firstName: true,
                            lastName: true,
                            userPath: true,
                            image: true,
                            profilePicture: true,
                        }
                    },
                    to: {
                        select: {
                            firstName: true,
                            lastName: true,
                            userPath: true,
                            image: true,
                            profilePicture: true,
                        }
                    },
                }
            })

            if (data) {

                const notifications = [];

                for (let i = 0; i < data.length; i++) {

                    let pic;

                    if (data[i].from.profilePicture) {
                        pic = data[i].from.profilePicture;
                    } else {
                        pic = data[i].from.image;
                    }

                    let note;

                    switch (data[i].type) {

                        case 'friendrequest':
                            note = {

                                id: data[i].id,
                                type: 'friendrequest',
                                message: `Du har fått en vänförfrågan från ${data[i].from.firstName} ${data[i].from.lastName}`,
                                image: pic,
                                updated: data[i].updated,
                                seen: data[i].seen,

                            }

                            break;

                        case 'friendrequest confirmed':
                            note = {
                                id: data[i].id,
                                type: 'friendrequest confirmed',
                                message: `${data[i].from.firstName} ${data[i].from.lastName} har bekräftat din vänförfrågan`,
                                image: pic,
                                updated: data[i].updated,
                                userPath: data[i].from.userPath,
                                seen: data[i].seen,

                            }

                            break;

                        case 'like post':

                            const post = await prisma.post.findUnique({
                                where: { id: data[i].targetPost_id },
                                select: {
                                    likes: {
                                        orderBy: {
                                            created: 'desc'
                                        },
                                        select: {
                                            liked_by: {
                                                select: {
                                                    firstName: true,
                                                    lastName: true,
                                                }
                                            }
                                        }
                                    }
                                }
                            })

                            let message;

                            if (post.likes.length === 1) {

                                message = `${post.likes[0].liked_by.firstName} ${post.likes[0].liked_by.lastName} har gillat ditt inlägg`;

                            } else if (post.likes.length === 2) {

                                message = `${post.likes[0].liked_by.firstName} ${post.likes[0].liked_by.lastName} och ${post.likes[1].liked_by.firstName} ${post.likes[1].liked_by.lastName} har gillat ditt inlägg`;

                            } else {

                                const number = post.likes.length - 2;
                                `${post.likes[0].liked_by.firstName} ${post.likes[0].liked_by.lastName}, ${post.likes[1].liked_by.firstName} ${post.likes[1].liked_by.lastName} och ${number} andra har gillat ditt inlägg`;

                            }

                            note = {
                                id: data[i].id,
                                type: 'like post',
                                message: message,
                                image: pic,
                                updated: data[i].updated,
                                userPath: data[i].from.userPath,
                                seen: data[i].seen,
                                targetPost: data[i].targetPost,

                            }

                            break;

                        default:

                            note = {
                                id: data[i].id,
                                type: 'default',
                                message: data[i].message,
                                updated: data[i].updated,
                                seen: data[i].seen,

                            }

                    }

                    notifications.push(note);

                }

                socket.emit('get notifications', notifications);

            }

        } catch (e) {

            console.log(e);

        }



    })

    socket.on('check unseen notifications', async () => {

        try {

            const notifications = await prisma.notification.findMany({
                where: { to_id: socket.data.user.id }

            })

            if (notifications) {

                let unseen = 0;

                for (let i = 0; i < notifications.length; i++) {

                    if (!notifications[i].seen) {

                        unseen++;

                    }

                }

                if (unseen > 0) {

                    socket.emit('notification', unseen);


                }

            }

        } catch (e) {

            console.log(e);

        }



    })

    socket.on('get friends list', async () => {

        try {

            const user = await prisma.user.findUnique({
                where: { id: socket.data.user.id },
                select: {
                    friends: {
                        select: {
                            firstName: true,
                            lastName: true,
                            userPath: true,
                            image: true,
                            socketId: true,
                            id: true,
                            profilePicture: true,
                        }
                    }
                }
            })

            if (!user) {

                socket.emit('error', 'Could not find user');
                return;

            }

            socket.emit('get friends list', user.friends);

        } catch (e) {

            console.log(e);

        }
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