export * from './constants';
export * from './rbac';

// There is deliberately no shared DTO module. `types.ts` once declared eight
// request/response interfaces, and a forensic sweep found every one of them
// had zero consumers: the API shapes its responses in its services, and the
// web and mobile clients each declare the narrow interface the screen needs.
// A shared-types file nothing imports is worse than none, because it reads as
// a contract the three packages honour when they do not. Add types here only
// alongside the import that uses them.
