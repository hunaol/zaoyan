package com.zaoyan.repo;
import com.zaoyan.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
public interface ForecastRepository extends JpaRepository<ForecastRun,String>,org.springframework.data.jpa.repository.JpaSpecificationExecutor<ForecastRun> {
    List<ForecastRun> findTop30ByOriginAndMealSlotOrderByCreatedAtDesc(Origin origin,String mealSlot);
    List<ForecastRun> findByStatusIn(Collection<String> states);
}
