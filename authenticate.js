import jwt from 'jsonwebtoken';
import prisma from './prisma/client.js';
const authenticate = (req, res, next) => {

    try {

        const token = req.headers.authorization.split(' ')[1];
        jwt.verify(token, process.env.JWT_SECRET, async (err, data) => {

            if (err) {

                if (err.message === 'jwt expired') {

                    res.sendStatus(401);
                    return;

                }

                res.sendStatus(403);
                return;
            }

            const user = await prisma.user.findUnique({
                where: { id: data.userId }
            });

            console.log(user);

            if (!user) {

                res.sendStatus(403);
                return;

            }

            req.userId = data.userId;
            next();
        })

    } catch (e) {

        console.log(e);
        res.sendStatus(403);

    }

}

export default authenticate;