# 09 — Estado

`memoria.ts`: memoria larga local (hasta 80 hechos en `localStorage`) que viaja en cada turno y se sincroniza con `POST /api/memoria` cuando hay sesión. `olvidarTodo()` borra local y remoto.
La memoria durable por miembro vive en el servidor (`lib/memoria.ts`, S3).
