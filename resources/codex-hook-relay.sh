#!/bin/sh

# Synapse hook relay. It must always fail open so Codex is never blocked.
synapse_support_dir="${SYNAPSE_SUPPORT_DIR:-${HOME}/Library/Application Support/Synapse}"
synapse_socket_path="${synapse_support_dir}/run/hook.sock"
synapse_spool_dir="${synapse_support_dir}/spool"

/bin/mkdir -p "${synapse_spool_dir}" 2>/dev/null || true
/bin/chmod 700 "${synapse_spool_dir}" 2>/dev/null || true

synapse_temp_file="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/synapse-hook.XXXXXX" 2>/dev/null)" || synapse_temp_file=""
if [ -n "${synapse_temp_file}" ]; then
  /bin/chmod 600 "${synapse_temp_file}" 2>/dev/null || true
  /bin/cat > "${synapse_temp_file}" 2>/dev/null || true

  synapse_payload_size="$(/usr/bin/wc -c < "${synapse_temp_file}" | /usr/bin/tr -d ' ')"
  if [ -S "${synapse_socket_path}" ] && { /usr/bin/printf '%s\n' "${synapse_payload_size}"; /bin/cat "${synapse_temp_file}"; } | /usr/bin/nc -U -w 1 "${synapse_socket_path}" >/dev/null 2>&1; then
    :
  else
    synapse_spool_name="$(/bin/date -u +%Y%m%dT%H%M%S)-$$-${RANDOM:-0}.json"
    synapse_spool_temp="${synapse_spool_dir}/.${synapse_spool_name}.tmp"
    if /bin/cp "${synapse_temp_file}" "${synapse_spool_temp}" 2>/dev/null; then
      /bin/chmod 600 "${synapse_spool_temp}" 2>/dev/null || true
      /bin/mv "${synapse_spool_temp}" "${synapse_spool_dir}/${synapse_spool_name}" 2>/dev/null || true
    fi
  fi
  /bin/rm -f "${synapse_temp_file}" 2>/dev/null || true
fi

/usr/bin/printf '{}\n'
exit 0
