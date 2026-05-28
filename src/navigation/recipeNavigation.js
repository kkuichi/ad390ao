// Otvorí RecipeDetail v záložke Recepty (tab bar zostane).

export function openRecipeDetail(navigation, { recipeId, initialRecipe } = {}) {
  if (!recipeId) return;
  navigation.navigate('Recipes', {
    screen: 'RecipeDetail',
    params: {
      recipeId,
      ...(initialRecipe != null ? { initialRecipe } : {}),
    },
  });
}
