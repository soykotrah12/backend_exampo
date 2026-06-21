const HttpProxy = require('http-proxy');
const proxy = new HttpProxy();
const streamify = require('stream-array');

exports.proxyMiddleware = (req, res, next) => {
    let slug = req.headers.slug

    let user = req?.user||{}

    if (!slug) {
        return res.status(400).json({ error: "Account not found" });
    } else {
        proxy.web(req, res, {
            target: `http://${slug}:3000/${req.baseUrl}`,
            headers:{
                user:JSON.stringify(user)
            }
        }, next);
    }
};