#!/usr/bin/env node
import {notify} from '../../../src/notify.mjs';
notify().catch(error => {console.error(error.message); process.exitCode = 1;});
