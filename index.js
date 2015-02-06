var fs          = require('fs');
var pj          = require('path').join;
var bl          = require('bl');
var knox        = require('knox');
var sc          = require('strcolour');
var git         = require('git-repo-info');
var rimraf      = require('rimraf');
var spawn       = require('child_process').spawn;




exports.command = function() {
    var yargs = require('yargs').argv;

    // No args passed, return usage
    if(yargs._.length === 0 || yargs._[0] === 'help') {
        console.log(sc(fs.readFileSync(pj(__dirname, 'USAGE'), 'utf8')));
        process.exit(0);
    }

    var packagePath = pj(process.cwd(), 'package.json');
    var packagePathExists = fs.existsSync(packagePath);

    if(!packagePathExists) errxit(1,
        'Could not find@W', packagePath, '@ncannot proceed');

    var packageJSON = require(packagePath);

    if(!packageJSON.name || !packageJSON.version) {
        errxit(1, 'Your package.json has no name/version, cannot proceed');
    }

    // Handle commands
    switch(yargs._[0]) {

        case 'init':
            if(yargs._.length !== 4) errxit(1,
                'insufficient arguments to init, see ngitpm help.');

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
                if(err) errxit(1, 'failed to write@W', packagePath, '@n');
            });
            break;

        case 'publish':
            if(!packageJSON.ngitpm) errxit(
                1,'You must ngitpm init before you can publish');

            if(!packageJSON.repository) errxit(
                1, 'Your package.json has no repository specified,',
                    'cannot proceed');

            if(packageJSON.repository.type !== 'git') errxit(
                1, 'Your specified repository is not of type git,',
                    'cannot proceed');

            var gitInfo = git();

            var repo = packageJSON.repository.url;
            var commit = yargs.commit || gitInfo.abbreviatedSha;

            fetchManifest(packageJSON.ngitpm, function(manifest) {
                // update the manifest
                var name = packageJSON.name;
                var ver = packageJSON.version;
                if(!manifest[name]) manifest[name] = {};
                var minifest = manifest[name];

                if(minifest[ver] && !yargs.force) errxit(
                    1, 'Version@W', ver, '@nof@W', name, '@nalready exists.');

                minifest[ver] = {
                    published : new Date(),
                    repo : repo,
                    commit : commit
                };

                publishManifest(packageJSON.ngitpm, manifest, name, ver);

            });
            break;

        case 'dump-repo':
            fetchManifest(packageJSON.ngitpm, function(manifest) {
                console.log(manifest);
            });
            break;

        case 'list':
            if(!packageJSON.ngitpm) errxit(
                1,'You must ngitpm init before you can list');

            fetchManifest(packageJSON.ngitpm, function(manifest) {

                if(yargs._.length === 1) {
                    console.log(sc('@CAvailable packages:@n'));
                    var keys = Object.keys(manifest);
                    if(!keys.length) errxit(0, 'no packages found');
                    keys.forEach(function(k) {
                        console.log(sc('\t-\t@W'+k+'@n'));
                    });
                }
                if(yargs._.length === 2) {
                    var minifest = manifest[yargs._[1]];
                    if(!minifest) errxit(
                        1, 'no package@W', yargs._[1], '@nfound.');
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
            if(!packageJSON.ngitpm) errxit(
                1,'You must ngitpm init before you can install');
            if(yargs._.length === 1) errxit(
                1, "You must specify a package to install");
            var name = yargs._[1];
            var version;
            if(yargs._.length == 3) version = yargs._[2];
            fetchManifest(packageJSON.ngitpm, function(manifest) {
                var minifest = manifest[name];
                if(!minifest) errxit(1, 'no package@W', name, '@nfound.');
                //find the highest version
                if(!version) version = Object.keys(minifest).sort().pop();
                var details = minifest[version];
                if(!details) errxit(1,'no version@W', version, '@nfound.');
                updatePackage(packagePath, function(json) {
                    //set deps
                    if(!json.dependencies) json.dependencies = {};
                    var prefix;
                    if(details.repo.slice(0,3) !== 'git') {
                        prefix = 'git+';
                    }
                    json.dependencies[name] = prefix + 
                        details.repo+'#'+details.commit;
                    return json;
                }, function(err) {
                    if(err) errxit(1, 'failed to write@W', packagePath, '@n');
                    //remove old module and npm install again
                    var modPath = pj(process.cwd(), 'node_modules', name);
                    rimraf(modPath, function(err) {
                        if(err) errxit(1, 'error removing old module');
                        spawn('npm', ['install'], {stdio : 'inherit'});
                    });
                    
                });
            });
            break;
    }


};

function errxit(exitCode) {
    console.log(sc(
        Array.prototype.slice.call(arguments).slice(1).join(' ')));
    process.exit(exitCode);
}

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


