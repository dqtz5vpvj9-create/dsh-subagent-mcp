#!/usr/bin/env node
import {setup} from '../src/setup.mjs';
setup(process.argv.slice(2), {source: true}).catch(error => {console.error(error.message); process.exitCode = 1;});
