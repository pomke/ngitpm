ngitpm
======

Ngitpm is a tool for managing git-url-based private dependencies within an
npm project, without pushing your private packages to NPM. It does this by 
maintaining a very simple json file NPM repository stored in s3.

Audience
========

Ngitpm is intended for small to medium development teams with requirements
to manage closed source or private dependencies, along side regular npm 
dependencies. Ngitpm is intended as a free replacement for NPM Enterprise, 
if you have a very large team and/or strict publishing ACL requirements you
should probably look at paying for NPM Enterprise.

Caveats
=======

* Race conditions for publish are stompy in nature, last write wins.
* Requires access to s3 and the ability to create AWS IAM credentials.
* Authentication credentials are stored in the repository, anyone with
repository access can publish to the repository.

How it works
============

Installation:

```bash 
$ npm install -g ngitpm
```

In your private package root (requires package.json and valid git repo):

```bash
# s3 creds require write access
$ ngitpm init <s3 bucket> <s3 key> <s3 secret>
$ ngitpm publish
published revision 2.4.1
```


In packages that require your private package:

```bash
# s3 creds require read access only
$ ngitpm init <s3 bucket> <s3 key> <s3 secret>
$ ngitpm list <package name>
2.4.1
2.3.9
2.3.8
2.3.7

$ ngitpm install <package name> 2.4.1
```

More info
=========

See '''ngitpm help''' for detailed usage.
