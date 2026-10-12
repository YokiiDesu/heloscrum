import {writeFile} from 'node:fs/promises';
import {openapi} from '../lib/api-contract.mjs';
const schema=JSON.stringify(openapi(),null,2)+'\n';
if(process.argv[2])await writeFile(process.argv[2],schema);else process.stdout.write(schema);
