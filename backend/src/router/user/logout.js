export default async function logout(req, rep) {
    if (req.session?.get('login') !== true) {
        rep.status(403).send({
            error: 'Forbidden',
            code: 'NOT_LOGGED_IN',
            message: 'You are not logged in.',
        });
        return;
    }

    req.session.delete();
    rep.status(200).send({ code: 'OK' });
}