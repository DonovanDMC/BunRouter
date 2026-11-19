// type-only checks, run by tsc and never executed
import { BodyParser } from "../src/middleware.js";
import Router, { type AnyPathMiddleware, type Middleware } from "../src/Router.js";

declare function adds<T extends object>(value: T): AnyPathMiddleware<T>;
declare function plain<R extends string = string>(): Middleware<R>;
declare function needsUser<R extends string = string>(): Middleware<R, unknown, object, { user: string }>;

const router = new Router();
router.new("/users/:id", "GET")
    .use(plain())
    .use(adds({ user: "x" }))
    .use(needsUser())
    .use((req, server, next) => {
        req.user satisfies string;
        req.params.id satisfies string;
        return next(req, server);
    })
    .use(adds({ count: 1 }))
    .handle((req) => {
        req.user satisfies string;
        req.count satisfies number;
        req.params.id satisfies string;
        return new Response("ok");
    });

// @ts-expect-error user isn't added by anything before it
router.new("/a").use(needsUser());
router.new("/b").handle((req) => {
    // @ts-expect-error user doesn't exist without middleware adding it
    req.user satisfies unknown;
    return new Response("ok");
});

// parsedBody is typed from parse
router.new("/d", "POST")
    .use(BodyParser({ parse: raw => raw as { n: number } }))
    .handle(req => new Response(String(req.parsedBody.n * 2)));
router.new("/e/:id", "POST")
    .use(BodyParser())
    .handle((req) => {
        req.parsedBody satisfies unknown;
        req.params.id satisfies string;
        return new Response("ok");
    });

const chain = router.use(adds({ user: "x" })).use(plain());
chain.new("/c/:id").use(needsUser()).handle(req => new Response(req.user + req.params.id));

// the README example
function withUser<R extends string>(): Middleware<R, unknown, { user: string }> {
    return (req, server, next) => next(Object.assign(req, { user: "someone" }), server);
}
router.new("/f/:id", "GET").use(withUser()).handle(req => new Response(`${req.user} wants ${req.params.id}`));
