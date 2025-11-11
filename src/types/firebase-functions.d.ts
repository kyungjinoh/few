declare module "firebase/functions" {
  import type { FirebaseApp } from "firebase/app";

  export interface HttpsCallableResult<T = unknown> {
    data: T;
  }

  export interface HttpsCallableOptions {
    timeout?: number;
    limitedUseAppCheckTokens?: boolean;
  }

  export type HttpsCallable<T = unknown, R = unknown> = (
    data?: T,
    options?: HttpsCallableOptions
  ) => Promise<HttpsCallableResult<R>>;

  export interface Functions {}

  export function getFunctions(
    app?: FirebaseApp,
    regionOrCustomDomain?: string
  ): Functions;

  export function httpsCallable<T = unknown, R = unknown>(
    functionsInstance: Functions,
    name: string,
    options?: HttpsCallableOptions
  ): HttpsCallable<T, R>;
}

