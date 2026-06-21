const express = require('express')
const router = express.Router()
const userRoute = require("../route/user")
const { requireSignin } = require('../middleware/authMiddleware')



const moduleRoutes = [
    {
        path: "/user",
        route: userRoute
    },
    {
        path: "/project",
        route: require("../route/project"),
        middleware: [requireSignin],
    },
    {
        path: "/project/workflow",
        route: require("../route/workflow"),
        middleware: [requireSignin],
    },
    {
        path: "/project/item",
        route: require("../route/item"),
        middleware: [requireSignin],
    },
    {
        path: "/sprint",
        route: require("../route/sprint"),
        middleware: [requireSignin],
    },
    {
        path: "/wiki",
        route: require("../route/wiki"),
        middleware: [requireSignin],
    },
    {
        path: "/retro",
        route: require("../route/retro"),
        middleware: [requireSignin],
    },
    {
        path: "/collection",
        route: require("../route/apiCollection"),
        middleware: [requireSignin],
    },
    {
        path: "/redis",
        route: require("../route/redis"),
        middleware: [requireSignin],
    },
    {
        path: "/test-plan",
        route: require("../route/testPlans"),
        middleware: [requireSignin],
    },
    {
        path: "/history",
        route: require("../route/history"),
        middleware: [requireSignin],
    },
    {
        path: "/staff",
        route: require("../route/admin/staff"),
        middleware: [requireSignin],
    },
    {
        path: "/crm",
        route: require("../route/crm")
    },
    {
        path: "/comment",
        route: require("../route/comment")
    },
    {
        path: "/chat",
        route: require("../route/chat")
    },
    {
        path: "/calendar",
        route: require("../route/calendar")
    },
    {
        path: "/organization",
        route: require("../route/organization")
    },
    {
        path: "/admin",
        route: require("../route/admin/auth")
    },
    {
        path:"/upload",
        route: require("../route/uploadRoute")
    },
    {
        path:"/query",
        route: require("../route/query")
    },
    {
        path:"/notification",
        route: require("../route/notification")
    },
    {
        path:"/validate",
        route: require("../route/toolsAndValidator")
    },
    {
        path:"/document",
        route: require("../route/doc")
    },


]


moduleRoutes.forEach((route) => {
    if (route.middleware) {
        router.use(route.path, ...route.middleware, route.route);
    } else {
        router.use(route.path, route.route);
    }
}
)
module.exports = router