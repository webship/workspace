#!/usr/bin/env bash

# Use python's argparse module in shell scripts
#
# The function `argparse` parses its arguments using
# argparse.ArgumentParser; the parser is defined in the function's
# stdin.
#
# Executing ``argparse.bash`` (as opposed to sourcing it) prints a
# script template.
#
# https://github.com/nhoffman/argparse-bash
# MIT License - Copyright (c) 2015 Noah Hoffman

argparse(){
    argparser=$(mktemp 2>/dev/null || mktemp -t argparser)
    cat > "$argparser" <<EOF
from __future__ import print_function
import sys
import argparse
import os


class MyArgumentParser(argparse.ArgumentParser):
    def print_help(self, file=None):
        """Print help and exit with a code of its own: the shell side ends the script with 0."""
        super(MyArgumentParser, self).print_help(file=file)
        sys.exit(64)

parser = MyArgumentParser(prog=os.path.basename("$0"),
            description="""$ARGPARSE_DESCRIPTION""")
EOF

    # stdin to this function should contain the parser definition
    cat >> "$argparser"

    cat >> "$argparser" <<EOF
args = parser.parse_args()
for arg in [a for a in dir(args) if not a.startswith('_')]:
    key = arg.upper()
    value = getattr(args, arg, None)

    if isinstance(value, bool) or value is None:
        print('{0}="{1}";'.format(key, 'yes' if value else ''))
    elif isinstance(value, list):
        print('{0}=({1});'.format(key, ' '.join('"{0}"'.format(s) for s in value)))
    else:
        print('{0}="{1}";'.format(key, value))
EOF

    # Define variables corresponding to the options if the args can be
    # parsed without errors; otherwise, print the text of the error
    # message.
    #
    # The command substitution MUST be quoted. Unquoted, the shell word-splits
    # and glob-expands the generated assignments before eval ever sees them, so
    # any argument value containing *, ? or [...] is silently rewritten to
    # whatever it happens to match in the current directory:
    #
    #   --summary "manage every cmd-*.sh here"
    #     run from commands/  ->  "manage every cmd-tools-commands.sh here"
    #     run from elsewhere  ->  unchanged
    #
    # It corrupts quietly and the result depends on the working directory, which
    # is why it went unnoticed: a glob matching nothing survives untouched.
    python "$argparser" "$@" &> /dev/null
    parsed=$?
    if [ $parsed -eq 0 ]; then
        eval "$(python "$argparser" "$@")"
        retval=0
    else
        python "$argparser" "$@"
        retval=1
    fi

    rm "$argparser"
    # -h / --help was asked for: the help is printed, and that is the whole run. It is an answer, not a
    # failure, so the script ends here with 0 (the callers' `|| exit 1` would turn it into 1). A wrong
    # or missing argument still returns 1 (argparse's own exit is 2), and the caller stops on it.
    if [ $parsed -eq 64 ]; then
        exit 0
    fi
    return $retval
}

# print a script template when this script is executed
if [[ $0 == *argparse.bash ]]; then
    cat <<FOO
#!/usr/bin/env bash

source \$(dirname \$0)/argparse.bash || exit 1
argparse "\$@" <<EOF || exit 1
parser.add_argument('infile')
parser.add_argument('-o', '--outfile')

EOF

echo "INFILE: \${INFILE}"
echo "OUTFILE: \${OUTFILE}"
FOO
fi
