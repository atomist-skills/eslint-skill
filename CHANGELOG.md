# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased](https://github.com/atomist-skills/eslint-skill/compare/1.5.0...HEAD)

### Fixed

-   Fix clean package script. [e2728af](https://github.com/atomist-skills/eslint-skill/commit/e2728afe769553e7785169e666672f8f6ad09ca4)

## [1.5.0](https://github.com/atomist-skills/eslint-skill/compare/1.4.0...1.5.0) - 2020-11-16

### Changed

-   Update skill icon. [5331687](https://github.com/atomist-skills/eslint-skill/commit/5331687fcba8ba57f85ab5d6e1b400d379f65abc)

## [1.4.0](https://github.com/atomist-skills/eslint-skill/compare/1.3.0...1.4.0) - 2020-11-13

### Removed

-   Remove unused chat integration. [d6b24a6](https://github.com/atomist-skills/eslint-skill/commit/d6b24a6f09984dcc9694b94af1a0104c688d9427)

## [1.3.0](https://github.com/atomist-skills/eslint-skill/compare/1.2.0...1.3.0) - 2020-10-16

### Changed

-   Use schema from @atomist/skill. [6d7ab8e](https://github.com/atomist-skills/eslint-skill/commit/6d7ab8e4e21695fcedf77dbcb396ea509a1fff86)

### Fixed

-   Fix clean package script. [9db2f04](https://github.com/atomist-skills/eslint-skill/commit/9db2f04c6afcd23545dbfdb420672bec1c447de3)

## [1.2.0](https://github.com/atomist-skills/eslint-skill/compare/1.1.0...1.2.0) - 2020-10-16

### Changed

-   Update skill category. [f5a9601](https://github.com/atomist-skills/eslint-skill/commit/f5a9601d79a41146dd75fe571ae7f0f36635b279)

## [1.1.0](https://github.com/atomist-skills/eslint-skill/compare/1.0.8...1.1.0) - 2020-10-14

### Added

-   Preserve spacing in package.json when updating dependencies. [#99](https://github.com/atomist-skills/eslint-skill/issues/99)

### Fixed

-   Always set commit check status. [#87](https://github.com/atomist-skills/eslint-skill/issues/87)
-   Check return value of project.spawn. [#88](https://github.com/atomist-skills/eslint-skill/issues/88)
-   Consider updating description of Fix problems parameter. [#97](https://github.com/atomist-skills/eslint-skill/issues/97)

## [1.0.8](https://github.com/atomist-skills/eslint-skill/compare/1.0.7...1.0.8) - 2020-09-15

### Added

-   Send eslint output to the skill log. [#68](https://github.com/atomist-skills/eslint-skill/issues/68)

### Changed

-   Remove node_modules from default ignore. [7f90e90](https://github.com/atomist-skills/eslint-skill/commit/7f90e90cc29801268acf207c86eb4f2c03d05f0d)
-   Update Info section. [#70](https://github.com/atomist-skills/eslint-skill/issues/70)
-   Split README. [#71](https://github.com/atomist-skills/eslint-skill/issues/71)

## [1.0.7](https://github.com/atomist-skills/eslint-skill/compare/1.0.6...1.0.7) - 2020-07-28

### Changed

-   Update category. [83eb245](https://github.com/atomist-skills/eslint-skill/commit/83eb24520c59141ff1ce55b99a4743b45b57149a)

## [1.0.6](https://github.com/atomist-skills/eslint-skill/compare/1.0.5...1.0.6) - 2020-07-17

### Added

-   Add support for configuring project. [79869ff](https://github.com/atomist-skills/eslint-skill/commit/79869ff18ae5d3b84f00cb15308128e95d03faec)

## [1.0.5](https://github.com/atomist-skills/eslint-skill/compare/1.0.4...1.0.5) - 2020-07-16

### Changed

-   Set check to neutral when there are no actual errors. [20560a6](https://github.com/atomist-skills/eslint-skill/commit/20560a6fea29ab5170ad654abd76625dc307b014)
-   Ignore generated branches. [a636b6c](https://github.com/atomist-skills/eslint-skill/commit/a636b6cc34ece612644c3b5c41cf24c145329335)

## [1.0.4](https://github.com/atomist-skills/eslint-skill/compare/1.0.3...1.0.4) - 2020-06-29

### Changed

-   Update description. [672d925](https://github.com/atomist-skills/eslint-skill/commit/672d925e1f0bc58bfe07a1cfbcf1a1f0581fb952)

## [1.0.3](https://github.com/atomist-skills/eslint-skill/compare/1.0.2...1.0.3) - 2020-06-19

### Added

-   Skip over projects that have no matching files. [e57b8da](https://github.com/atomist-skills/eslint-skill/commit/e57b8da43afaa3d22fbc71ca5569b2a97a8d5d60)

### Removed

-   Remove yarn install. [84532bb](https://github.com/atomist-skills/eslint-skill/commit/84532bb109b396fa44b237c8efc29e37b3ce819d)

## [1.0.2](https://github.com/atomist-skills/eslint-skill/compare/1.0.1...1.0.2) - 2020-06-18

### Added

-   Add pull request labels. [43c1376](https://github.com/atomist-skills/eslint-skill/commit/43c137673c730a486d6b6165652218fab98c5969)

### Changed

-   Display file name only in PR body. [a4cf9b6](https://github.com/atomist-skills/eslint-skill/commit/a4cf9b671f5485ce9ad560767fbb4fbf5fe5eda1)

### Fixed

-   Clone branch and not sha so that we can commit back. [484ee36](https://github.com/atomist-skills/eslint-skill/commit/484ee36fb31d36c79bfb65979900455ddda5c6b3)

## [1.0.1](https://github.com/atomist-skills/eslint-skill/tree/1.0.1) - 2020-06-17

### Added

-   Close open pull requests when there aren't any fixes left. [a498952](https://github.com/atomist-skills/eslint-skill/commit/a498952506c10deb11501107fe915f646802d6b1)
-   Validate that project has package.json. [030e171](https://github.com/atomist-skills/eslint-skill/commit/030e171142246ec95b1d5e57f5b218858f637aa8)
-   Support additional options for pushing changes back. [#5](https://github.com/atomist-skills/eslint-skill/issues/5)
-   Support fixing issues and pushing back into repository. [#1](https://github.com/atomist-skills/eslint-skill/issues/1)

### Changed

-   Switch to new packaging. [ea950d1](https://github.com/atomist-skills/eslint-skill/commit/ea950d1ce70bd7a8c5345519a52f2a57439598bf)
