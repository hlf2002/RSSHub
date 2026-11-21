import type { Handler, Hono } from 'hono';

import type { RoutePath } from '@/../assets/build/route-paths';
import type { ConfigEnv } from '@/config';
import { setConfig } from '@/config';
import { runInCacheNamespace } from '@/utils/cache/scope';

import type { Data, Namespace, Route } from './types';

export * from '@/types';
export { default as ofetch } from '@/utils/ofetch';
export * from '@/utils/time';

let app: Hono | null = null;

function ensureAppInitialized(app: Hono | null): asserts app is Hono {
    if (!app) {
        throw new Error('RSSHub not initialized. Please call init() first.');
    }
}

export async function init(conf?: ConfigEnv) {
    setConfig(
        Object.assign(
            {
                IS_PACKAGE: true,
            },
            conf
        )
    );
    app = (await import('@/app')).default;
}

export async function request(path: RoutePath | (string & {})): Promise<Data> {
    ensureAppInitialized(app);

    const res = await app.request(path);
    return res.json();
}

/**
 * Same as {@link request} but returns the rendered feed (RSS XML by default), for embedders that
 * speak the RSSHub HTTP contract (e.g. a worker posting XML back to a scheduler).
 * Pass `format=atom|json` to render another format.
 */
export async function requestXml(path: RoutePath | (string & {})): Promise<string> {
    ensureAppInitialized(app);

    const url = new URL(path, 'http://localhost');
    if (!url.searchParams.has('format')) {
        url.searchParams.set('format', 'rss');
    }

    const res = await app.request(url.pathname + url.search);
    return res.text();
}

export async function registerRoute(namespace: string, route: Route, namespaceConfig?: Namespace) {
    ensureAppInitialized(app);

    const { namespaces } = await import('./registry');

    if (!Object.hasOwn(namespaces, namespace)) {
        namespaces[namespace] = {
            ...namespaceConfig,
            name: namespaceConfig?.name || namespace,
            routes: {},
            apiRoutes: {},
        };
    }

    const paths = Array.isArray(route.path) ? route.path : [route.path];
    const subApp = app.basePath(`/${namespace}`);

    const wrappedHandler: Handler = async (ctx) => {
        if (ctx.get('data')) {
            return;
        }
        const response = await runInCacheNamespace(namespace, () => route.handler(ctx));
        if (response instanceof Response) {
            return response;
        }
        ctx.set('data', response);
    };

    for (const path of paths) {
        namespaces[namespace].routes[path] = {
            ...route,
            location: `custom/${namespace}`,
        };

        subApp.get(path, wrappedHandler);
    }
}
