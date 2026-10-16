package com.zaoyan.repo;
import com.zaoyan.domain.Stall;
import org.springframework.data.jpa.repository.JpaRepository;
public interface StallRepository extends JpaRepository<Stall, Long> {
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select s from Stall s where s.id = :id")
    java.util.Optional<Stall> lockById(@org.springframework.data.repository.query.Param("id")Long id);
}
