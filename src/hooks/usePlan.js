// Hook: načítanie a úpravy týždenného plánu jedál z Firestore.
import { useEffect, useState, useCallback } from 'react';
import { getWeekPlan, setWeekPlan, addRecipeToPlan, removeRecipeFromPlan, getWeekId } from '../services/firestore/plans';


export function usePlan(uid, weekId) {
  const ww = weekId || getWeekId(new Date());
  const [plan, setPlanState] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!uid) {
      setPlanState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const p = await getWeekPlan(uid, ww);
    setPlanState(p ?? { days: [] });
    setLoading(false);
  }, [uid, ww]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const setPlan = useCallback(
    async (newPlan) => {
      if (!uid) return;
      await setWeekPlan(uid, ww, newPlan);
      await refetch();
    },
    [uid, ww, refetch]
  );

  const addRecipe = useCallback(
    async (dateStr, recipeId, mealType = 'dinner') => {
      if (!uid) return;
      await addRecipeToPlan(uid, ww, dateStr, recipeId, mealType);
      await refetch();
    },
    [uid, ww, refetch]
  );

  const removeRecipe = useCallback(
    async (dateStr, recipeId, mealType) => {
      if (!uid) return;
      await removeRecipeFromPlan(uid, ww, dateStr, recipeId, mealType);
      await refetch();
    },
    [uid, ww, refetch]
  );

  return {
    plan,
    weekId: ww,
    loading,
    refetch,
    setPlan,
    addRecipe,
    removeRecipe,
  };
}

export { getWeekId };
export default usePlan;
