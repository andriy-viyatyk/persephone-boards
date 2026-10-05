/* Minimal Reflect metadata API required by the vendored tsyringe-based x509 UMD build. */
(function () {
    "use strict";

    const reflect = Reflect;
    const metadata = new WeakMap();

    // Return or create metadata maps indexed by target and optional property key.
    function ownMap(target, propertyKey, create) {
        let keys = metadata.get(target);
        if (!keys && create) {
            keys = new Map();
            metadata.set(target, keys);
        }
        if (!keys) return undefined;

        let values = keys.get(propertyKey);
        if (!values && create) {
            values = new Map();
            keys.set(propertyKey, values);
        }
        return values;
    }

    if (!reflect.defineMetadata) {
        reflect.defineMetadata = (metadataKey, metadataValue, target, propertyKey) => {
            ownMap(target, propertyKey, true).set(metadataKey, metadataValue);
        };
    }

    if (!reflect.hasOwnMetadata) {
        reflect.hasOwnMetadata = (metadataKey, target, propertyKey) => {
            const values = ownMap(target, propertyKey, false);
            return Boolean(values && values.has(metadataKey));
        };
    }

    if (!reflect.getOwnMetadata) {
        reflect.getOwnMetadata = (metadataKey, target, propertyKey) => {
            const values = ownMap(target, propertyKey, false);
            return values && values.get(metadataKey);
        };
    }

    if (!reflect.hasMetadata) {
        reflect.hasMetadata = (metadataKey, target, propertyKey) =>
            reflect.getMetadata(metadataKey, target, propertyKey) !== undefined;
    }

    if (!reflect.getMetadata) {
        reflect.getMetadata = (metadataKey, target, propertyKey) => {
            for (let current = target; current; current = Object.getPrototypeOf(current)) {
                if (reflect.hasOwnMetadata(metadataKey, current, propertyKey)) {
                    return reflect.getOwnMetadata(metadataKey, current, propertyKey);
                }
            }
            return undefined;
        };
    }

    if (!reflect.metadata) {
        reflect.metadata = (metadataKey, metadataValue) => (target, propertyKey) => {
            reflect.defineMetadata(metadataKey, metadataValue, target, propertyKey);
        };
    }

    if (!reflect.deleteMetadata) {
        reflect.deleteMetadata = (metadataKey, target, propertyKey) => {
            const values = ownMap(target, propertyKey, false);
            return values ? values.delete(metadataKey) : false;
        };
    }
}());
