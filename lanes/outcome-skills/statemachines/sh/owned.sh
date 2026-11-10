# The package names the repository publishes, one per line: Cargo.toml [package] name, package.json name, go.mod module,
# pom.xml's first artifactId and each .csproj's file name. $1 is the tree.
set -u
cd "$1"
git ls-files -z -- '*Cargo.toml' | xargs -0 -r awk '/^\[/{p=($0=="[package]")} p && /^name *=/{gsub(/^name *= *"|".*$/,""); print}' 2>/dev/null
git ls-files -z -- '*package.json' | xargs -0 -r grep -h -m1 -o '"name" *: *"[^"]*"' 2>/dev/null | sed 's/.*: *"//; s/"$//'
git ls-files -z -- '*go.mod' | xargs -0 -r awk '/^module /{print $2}' 2>/dev/null
git ls-files -z -- '*pom.xml' | xargs -0 -r -n1 sh -c 'grep -m1 -o "<artifactId>[^<]*</artifactId>" "$0" | sed "s/<[^>]*>//g"' 2>/dev/null
git ls-files -- '*.csproj' | sed 's#.*/##; s#\.csproj$##'
exit 0
