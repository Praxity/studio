if original_mode="$(defaults read -g AppleKeyboardUIMode 2>/dev/null)"; then
  [[ "$original_mode" =~ ^[0-9]+$ ]] || { echo "Invalid AppleKeyboardUIMode: $original_mode" >&2; exit 1; }
else
  original_mode=absent
fi
echo "original_mode=$original_mode" >> "$GITHUB_OUTPUT"
defaults write -g AppleKeyboardUIMode -int 2
