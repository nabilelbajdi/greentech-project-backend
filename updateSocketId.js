import prisma from "./prisma/client.js";

const updateSocketId = async (socket, disconnect) => {

    let socketId;

    if (disconnect) {

        socketId = null

    } else {

        socketId = socket.id

    }

    const updatedUser = await prisma.user.update({
        where: {
            id: socket.data.user.id
        },
        data: {
            socketId
        }
    })

    if (!updatedUser) {

        socket.emit('error', 'Database error');

    }

}

export default updateSocketId;