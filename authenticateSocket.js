import jwt from 'jsonwebtoken';
import prisma from './prisma/client.js';

const authenticateSocket = (socket, next) => {

    const token = socket.handshake.auth.token;

    jwt.verify(token, process.env.JWT_SECRET, async (err, data) => {

        if (err) {

            next(new Error('Not authorized'))
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id: data.userId }
        });

        if (!user) {

            next(new Error('Not authorized'))
            return;

        }
        socket.data.user = user;
        next();
    })

}

export default authenticateSocket;