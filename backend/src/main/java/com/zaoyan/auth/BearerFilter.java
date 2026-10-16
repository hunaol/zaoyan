package com.zaoyan.auth;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.util.List;

@Component
public class BearerFilter extends OncePerRequestFilter {
    private final TokenService tokens;
    public BearerFilter(TokenService tokens){this.tokens=tokens;}
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse resp,FilterChain chain)
        throws ServletException,IOException {
        String h=req.getHeader("Authorization");
        TokenService.Session session=tokens.inspect(h!=null&&h.startsWith("Bearer ")?h.substring(7):null);
        if(session!=null){
            var auth=new UsernamePasswordAuthenticationToken(session.username(),null,List.of(new SimpleGrantedAuthority("ROLE_"+session.role())));
            SecurityContextHolder.getContext().setAuthentication(auth);
        }
        try { chain.doFilter(req,resp); } finally { SecurityContextHolder.clearContext(); }
    }
}
