exports.api = async (...a) => (globalThis.__api ? globalThis.__api(...a) : {});
