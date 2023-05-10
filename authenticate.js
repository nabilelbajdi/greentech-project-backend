import jwt from 'jsonwebtoken';

const authenticate = (req, res, next) => {

    try {

        const token = req.headers.authorization.split(' ')[1];
        jwt.verify(token, process.env.JWT_SECRET, (err, data) => {

            if (err) {

                if (err.message === 'jwt expired') {

                    res.sendStatus(401);
                    return;

                }

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