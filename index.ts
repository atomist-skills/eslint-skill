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

import { gitHubResourceProvider, slackResourceProvider } from "@atomist/skill/lib/resource_providers";
import { LineStyle, ParameterType, ParameterVisibility, repoFilter, skill } from "@atomist/skill/lib/skill";
import { LintConfiguration } from "./lib/configuration";

export const Skill = skill<LintConfiguration & { repos: any }>({
    runtime: {
        memory: 2048,
        timeout: 540,
    },

    resourceProviders: {
        github: gitHubResourceProvider({ minRequired: 1 }),
        slack: slackResourceProvider({ minRequired: 0 }),
    },

    parameters: {
        ext: {
            type: ParameterType.StringArray,
            displayName: "Extensions",
            description: "File extensions to lint (defaults to .js)",
            required: false,
        },
        config: {
            type: ParameterType.String,
            displayName: "Configuration",
            description:
                "ESLint configuration in JSON format used if project does not contain own configuration. See the [ESLint documentation](https://eslint.org/docs/user-guide/configuring) on how to configure it.",
            lineStyle: LineStyle.Multiple,
            required: false,
        },
        ignores: {
            type: ParameterType.StringArray,
            displayName: "Ignore Pattern",
            description: "Pattern of files or folders to ignore during linting",
            required: false,
        },
        args: {
            type: ParameterType.StringArray,
            displayName: "Extra arguments",
            description:
                "Additional [command line arguments](https://eslint.org/docs/2.13.1/user-guide/command-line-interface) passed to ESLint",
            required: false,
        },
        modules: {
            type: ParameterType.StringArray,
            displayName: "NPM packages to install",
            description:
                "Use this parameter to configure NPM packages like eslint itself or plugins that should get installed",
            required: false,
        },
        push: {
            type: ParameterType.SingleChoice,
            displayName: "Fix Problems",
            description:
                "Run ESLint with `--fix` option and determine how and when fixes should be committed back into the repository",
            defaultValue: "pr_default_commit",
            options: [
                {
                    text: "Raise pull request for default branch; commit to other branches",
                    value: "pr_default_commit",
                },
                {
                    text: "Raise pull request for default branch only",
                    value: "pr_default",
                },
                {
                    text: "Raise pull request for any branch",
                    value: "pr",
                },
                {
                    text: "Commit to default branch only",
                    value: "commit_default",
                },
                {
                    text: "Commit to any branch",
                    value: "commit",
                },
                {
                    text: "Do not run --fix",
                    value: "none",
                },
            ],
            required: false,
        },
        commitMsg: {
            type: ParameterType.String,
            displayName: "Commit message",
            description: "Commit message to use when committing ESLint fixes back into the repository",
            placeHolder: "ESLint fixes",
            required: false,
            visibility: ParameterVisibility.Hidden,
        },
        repos: repoFilter(),
    },

    subscriptions: ["file://graphql/subscription/*.graphql"],
});
