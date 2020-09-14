/*
 * Copyright © 2020 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const stylish = require("eslint/lib/cli-engine/formatters/stylish");
const fs = require("fs");

module.exports = function(results) {
    fs.writeFileSync(process.env.ESLINT_REPORT_FILE || "report.json", JSON.stringify(results, undefined, 2));
    return stylish(results);
};