package com.zaoyan.repo;
import com.zaoyan.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.time.LocalDate;
import java.util.Optional;
public interface PrepRepository extends JpaRepository<PrepRecord,Long> {
    List<PrepRecord> findByStallIdAndOriginAndServiceDate(Long stallId,Origin origin,LocalDate serviceDate);
    List<PrepRecord> findByStallIdAndVerificationSource(Long stallId,String source);
    List<PrepRecord> findByOriginOrderByServiceDateDesc(Origin origin);
    List<PrepRecord> findByOriginAndMealSlotAndActualQtyIsNotNullOrderByServiceDateAsc(Origin origin,String mealSlot);
    Optional<PrepRecord> findByStallIdAndOriginAndServiceDateAndMealSlot(Long stallId,Origin origin,LocalDate date,String slot);
}
