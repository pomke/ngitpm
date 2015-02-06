var fs          = require('fs');
var pj          = require('path').join;
var bl          = require('bl');
var knox        = require('knox');
var sc          = require('strcolour');
var git         = require('git-repo-info');





exports.command = function() {
    var yargs = require('yargs').argv;

    // No args passed, return usage
    if(yargs._.length === 0 || yargs._[0] === 'help') {
        console.log(sc(fs.readFileSync(pj(__dirname, 'USAGE'), 'utf8')));
        process.exit(0);
    }

    var packagePath = pj(process.cwd(), 'package.json');
    var packagePathExists = fs.existsSync(packagePath);

    if(!packagePathExists) {
        console.log('Could not find', packagePath, 'cannot proceed');
        process.exit(1);
    }

    var packageJSON = require(packagePath);

    if(!packageJSON.name || !packageJSON.version) {
        console.log('Your package.json has no name/version, cannot proceed');
        process.exit(1);
    }

    // Handle commands
    switch(yargs._[0]) {

        case 'init':
            if(yargs._.length !== 4) {
                console.log('insufficient arguments to init, see ngitpm help.');
                process.exit(1);
            }

            var ngitpm = {
                    key : yargs._[2],
                    secret : yargs._[3]
                };
            // handle user passing in a bucket or subdirectory path
            var p = yargs._[1];
            var i = p.indexOf('/');
            if(i === -1) {
                ngitpm.bucket = p;
                ngitpm.path = '';
            } else {
                ngitpm.bucket = p.slice(0, i);
                ngitpm.path = p.slice(i);
            }

            updatePackage(packagePath, function(json) {
                json.ngitpm = ngitpm;
               return json;
            }, function(err) {
                if(err) {
                    console.log('failed to write', packagePath, ': ', err);
                    process.exit(1);
                }
            });
            break;

        case 'publish':
            if(!packageJSON.ngitpm) {
                console.log('You must ngitpm init before you can publish');
                process.exit(1);
            }

            if(!packageJSON.repository) {
                console.log('Your package.json has no repository specified, cannot proceed');
                process.exit(1);
            }

            if(!packageJSON.repository.type === 'git') {
                console.log('Your specified repository is not of type git, cannot proceed');
                process.exit(1);
            }

            var gitInfo = git();

            var repo = packageJSON.repository.url;
            var commit = yargs.commit || gitInfo.abbrebiatedSha;


            fetchManifest(packageJSON.ngitpm, function(manifest) {
                // update the manifest
                var name = packageJSON.name;
                var ver = packageJSON.version;
                if(!manifest[name]) manifest[name] = {};
                var minifest = manifest[name];

                if(minifest[ver] && !yargs.force) {
                    console.log('Version', ver, 'of', name, 'already exists.');
                    process.exit(1);
                }

                minifest[ver] = {
                    published : new Date(),
                    repo : repo,
                    commit : commit
                };

                publishManifest(packageJSON.ngitpm, manifest, name, ver);

            });
            break;

        case 'list':
            fetchManifest(packageJSON.ngitpm, function(manifest) {

                if(yargs._.length === 1) {
                    console.log(sc('@CAvailable packages:@n'));
                    var keys = Object.keys(manifest);
                    if(!keys.length) {
                        console.log('no packages found');
                        process.exit(0);
                    }
                    keys.forEach(function(k) {
                        console.log(sc('\t-\t@W'+k+'@n'));
                    });
                }
                if(yargs._.length === 2) {
                    var minifest = manifest[yargs._[1]];
                    if(!minifest) {
                        console.log('no package', yargs._[1], 'found.');
                        process.exit(1);
                    }
                    console.log(sc('@CAvailable versions:@n'));
                    var versions = Object.keys(minifest);
                    if(!versions.length) {
                        console.log('no versions found');
                    }
                    versions.forEach(function(k) {
                        console.log(sc('\t-\t@W'+k+'@n'));
                    });
                }
            });
            break;

        case 'install':
            if(yargs._.length === 1) {
                console.log("You must specify a package to install");
                process.exit(1);
            }
            var name = yargs._[1];
            var version;
            if(yargs._.length == 3) {
                version = yargs.__[2];
            }
            fetchManifest(packageJSON.ngitpm, function(manifest) {
                if(!manifest[name]) {
                    console.log('no package', name, 'found.');
                    process.exit(1);
                }
            });
            break;
    }


};


function publishManifest(s3Info, manifest, name, version) {
    var creds = {
        bucket : s3Info.bucket,
        key : s3Info.key,
        secret : s3Info.secret
    };
    var client = knox.createClient(s3Info);
    var path = pj(s3Info.path, '/manifest.json');

    var s = JSON.stringify(manifest);
    var req = client.put(path, {
        'Content-Length': Buffer.byteLength(s),
        'Content-Type': 'application/json'
    });
    req.on('response', function(res){
        if (200 == res.statusCode) {
            console.log('Published', name, version);
            process.exit(0);
        } else {
            console.log('Failed to publish manifest, s3 responded:', res.statusCode);
            console.log('Your credentials most likely lack write access');
            process.exit(1);
        }
    });
    req.end(s);
}

function fetchManifest(s3Info, cb) {
    var creds = {
        bucket : s3Info.bucket,
        key : s3Info.key,
        secret : s3Info.secret
    };
    var client = knox.createClient(s3Info);
    var path = pj(s3Info.path, '/manifest.json');
    client.getFile(path, function(err, res) {
        if(err) {
            console.log('failed fetching manifest from bucket', s3Info.bucket);
            process.exit(1);
        }
        res.pipe(bl(function(err, data) {
            if(err) {
                console.log('failed read manifest from bucket', s3Info.bucket);
                process.exit(1);
            }
            var out;
            try {
                out = JSON.parse(data.toString('utf8'));
            } catch(e) {
                out = {};
            }
            return cb(out);
        }));

    });

}


//Borrowed from grncdr/update-package-json
function updatePackage(filename, updateCb, cb) {
    fs.readFile(filename, function (er, data) {
        // ignore errors here, just don't save it.
        try {
            data = JSON.parse(data.toString('utf8'));
        } catch (ex) {
            er = ex;
        }
        if (er) {
            return cb();
        }
        updateCb(data);
        data = JSON.stringify(data, null, 2) + '\n';
        fs.writeFile(filename, data, cb);
    });
}


