import {
    gitHubResourceProvider,
    slackResourceProvider,
} from "@atomist/skill/lib/resource_providers";
import {
    LineStyle,
    ParameterType,
    skill,
} from "@atomist/skill/lib/skill";
import { LintConfiguration } from "./lib/configuration";

export const Skill = skill<LintConfiguration>({

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
            description: "ESLint configuration in JSON format used if project does not contain own configuration",
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
            description: "Command line arguments passed to ESLint",
            required: false,
        },
        push: {
            type: ParameterType.SingleChoice,
            displayName: "Fix Problems",
            description: "Run ESLint with --fix option and push fixes back into the repository",
            defaultValue: "pr",
            options: [{
                text: "Commit to default branch only",
                value: "commit_default",
            }, {
                text: "Commit to any branch",
                value: "commit",
            }, {
                text: "Raise Pull Request for default branch only",
                value: "pr_default",
            }, {
                text: "Raise Pull Request for any branch",
                value: "pr",
            }, {
                text: "Do not run --fix",
                value: "none",
            }],
            required: false,
        },
        commitMsg: {
            type: ParameterType.String,
            displayName: "Commit message",
            description: "Commit message to use when pushing ESLint fixes into the repository",
            placeHolder: "ESLint fixes",
            required: false,
        },
    },

    subscriptions: [
        "file://graphql/subscription/*.graphql",
    ],

});
