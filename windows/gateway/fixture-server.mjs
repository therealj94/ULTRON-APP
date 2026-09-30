// CI only: deterministic model fixture, never a production deployment.
import {createGateway} from './server.mjs';
const server=createGateway({apiToken:'windows-protocol-test-00000000000000000000',model:'fixture-only',modelUrl:'https://fixture.invalid',fetch:async()=>Response.json({choices:[{message:{content:'Windows gateway protocol OK'}}]})});
server.listen(18787,'127.0.0.1',()=>console.log('fixture ready'));
