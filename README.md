
NGITPM
======

Ngitpm is a helper tool for managing git-url-based private dependencies within an
npm project, without pushing your private packages to NPM. It does this by 
maintaining a very simple json file, stored in s3.


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


