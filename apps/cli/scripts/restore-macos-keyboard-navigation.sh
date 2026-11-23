if [[ "$ORIGINAL_MODE" == absent ]]; then
  defaults delete -g AppleKeyboardUIMode
elif [[ -n "$ORIGINAL_MODE" ]]; then
  defaults write -g AppleKeyboardUIMode -int "$ORIGINAL_MODE"
fi
