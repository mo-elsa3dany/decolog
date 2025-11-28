/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

const navigationHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(navigationHandler);
registerRoute(navigationRoute);

cleanupOutdatedCaches();
