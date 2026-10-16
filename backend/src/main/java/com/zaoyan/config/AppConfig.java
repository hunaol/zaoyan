package com.zaoyan.config;

import com.zaoyan.auth.BearerFilter;
import com.zaoyan.domain.Stall;
import com.zaoyan.repo.StallRepository;
import org.springframework.context.annotation.*;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.CommandLineRunner;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import java.util.concurrent.Executor;

@Configuration
@EnableMethodSecurity
public class AppConfig {
    @Bean FilterRegistrationBean<BearerFilter> bearerFilterRegistration(BearerFilter filter){
        var registration=new FilterRegistrationBean<>(filter);registration.setEnabled(false);return registration;
    }
    @Bean PasswordEncoder passwordEncoder(){return new BCryptPasswordEncoder();}
    @Bean SecurityFilterChain security(HttpSecurity http,BearerFilter filter)throws Exception{
        return http.csrf(c->c.disable()).cors(c->c.disable())
            .sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(e->e.authenticationEntryPoint((request,response,ex)->response.sendError(401)))
            .authorizeHttpRequests(a->a.requestMatchers("/api/auth/login","/api/health").permitAll()
               .requestMatchers("/api/**").authenticated().anyRequest().denyAll())
            .addFilterBefore(filter,UsernamePasswordAuthenticationFilter.class)
            .httpBasic(b->b.disable()).formLogin(f->f.disable()).build();
    }
    @Bean(name="taskExecutor") Executor executor(){
        var pool=new ThreadPoolTaskExecutor();
        pool.setCorePoolSize(2);pool.setMaxPoolSize(2);pool.setQueueCapacity(20);
        pool.setThreadNamePrefix("zaoyan-ai-");pool.initialize();return pool;
    }
    @Bean CommandLineRunner demoStall(StallRepository stalls){
        return args->{if(stalls.count()==0){var s=new Stall();s.name="演示档口 A01";s.location="本地模拟场景 · 未接入真实食堂";stalls.save(s);}};
    }
}
