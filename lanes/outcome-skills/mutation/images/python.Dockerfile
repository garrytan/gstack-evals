# Copyright (c) 2026 Garry Tan. MIT License.
# Mutation tool image for Python (outcome-per-skill plan v3, section 10): mutmut 3.8.1, BSD-3-Clause, with its
# dependencies as hash-checked wheels for CPython 3.11 to 3.14 on x86_64 Linux. The scorer installs them, offline, into a
# folder of their own on the task image and appends that folder to sys.path, so the project's own packages, pytest
# included, still win. git is here for the fixture images that start from this one.
FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
RUN apt-get update && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 && rm -rf /var/lib/apt/lists/*
COPY python-requirements.txt /opt/gstack-mutation/python/requirements.txt
RUN for v in 3.11 3.12 3.13 3.14; do \
      python -m pip download --no-cache-dir --disable-pip-version-check --no-deps --require-hashes --only-binary=:all: \
        --python-version "$v" --implementation cp --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64 \
        --platform manylinux_2_28_x86_64 --platform manylinux_2_5_x86_64 --platform manylinux1_x86_64 \
        -d /opt/gstack-mutation/python/wheels -r /opt/gstack-mutation/python/requirements.txt || exit 1; \
    done \
 && mkdir -p /opt/gstack-mutation/python/licence \
 && python -c "import zipfile,glob,email; w=glob.glob('/opt/gstack-mutation/python/wheels/mutmut-3.8.1-*.whl')[0]; z=zipfile.ZipFile(w); m=email.message_from_bytes(z.read('mutmut-3.8.1.dist-info/METADATA')); open('/opt/gstack-mutation/python/licence/spdx.txt','w').write((m.get('License-Expression') or m.get('License'))+'\n'); [open('/opt/gstack-mutation/python/licence/'+n.split('/')[-1],'wb').write(z.read(n)) for n in z.namelist() if not n.endswith('/') and ('/licenses/' in n or n.endswith('/LICENSE'))]"
