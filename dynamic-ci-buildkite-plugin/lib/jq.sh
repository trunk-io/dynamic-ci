#!/usr/bin/env bash
# Resolves the `jq` this plugin ships (from `vendor/`, deliberately off PATH), so adopting the plugin requires the
# customer to install nothing. Sourced by `hooks/command`.
#
# Vendored rather than downloaded at hook time: a fetch would put the network on
# the critical path of every build, and a checksum committed to git is a better
# supply-chain story than one resolved at runtime.

# Echoes the path to a verified jq for this platform, or fails with a message
# naming what it could not do. Verification happens once per hook run — the
# hash of a 2MB binary is cheap, and it is the only thing between a tampered
# vendored file and execution.
dci_resolve_jq() {
    local bin_dir="$1"
    local os arch name path

    os="$(uname -s)"
    arch="$(uname -m)"

    case "${os}/${arch}" in
    Linux/x86_64 | Linux/amd64) name="jq-linux-amd64" ;;
    Linux/aarch64 | Linux/arm64) name="jq-linux-arm64" ;;
    Darwin/arm64) name="jq-macos-arm64" ;;
    *)
        # Named explicitly so an unsupported agent is a legible one-line answer
        # rather than a build that quietly stops skipping anything.
        echo "no vendored jq for ${os}/${arch}" >&2
        return 1
        ;;
    esac

    path="${bin_dir}/${name}"
    if [[ ! -x ${path} ]]; then
        echo "vendored jq missing or not executable: ${path}" >&2
        return 1
    fi

    if ! dci_verify_checksum "${bin_dir}" "${name}"; then
        return 1
    fi

    echo "${path}"
}

# `sha256sum` on Linux, `shasum -a 256` on macOS. A platform with neither is
# refused rather than trusted: skipping the check would defeat the point of
# committing the sums.
dci_verify_checksum() {
    local bin_dir="$1" name="$2" expected actual

    expected="$(awk -v n="${name}" '$2 == n { print $1 }' "${bin_dir}/SHA256SUMS")"
    if [[ -z ${expected} ]]; then
        echo "no recorded checksum for ${name}" >&2
        return 1
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        actual="$(sha256sum "${bin_dir}/${name}" | awk '{ print $1 }')"
    elif command -v shasum >/dev/null 2>&1; then
        actual="$(shasum -a 256 "${bin_dir}/${name}" | awk '{ print $1 }')"
    else
        echo "no sha256 tool available to verify ${name}" >&2
        return 1
    fi

    if [[ ${actual} != "${expected}" ]]; then
        echo "checksum mismatch for ${name}: expected ${expected}, got ${actual}" >&2
        return 1
    fi
}
