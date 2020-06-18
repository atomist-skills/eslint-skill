# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased](https://github.com/atomist-skills/eslint-skill/compare/1.0.1...HEAD)

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
